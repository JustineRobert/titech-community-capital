'use strict';

/**
 * ============================================================================
 * ENTERPRISE MEMBER CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Multi-Tenant Support
 * ✅ Member Registration
 * ✅ Member Management
 * ✅ KYC Operations
 * ✅ Member Analytics
 * ✅ Search & Filtering
 * ✅ Pagination Support
 * ✅ Request Tracking
 * ✅ Audit Ready Responses
 * ✅ Production Grade Error Handling
 * ============================================================================
 */

const MemberService = require('../modules/member/services/memberService');
const { handleError } = require('../middlewares/errorMiddleware');

class MemberController {

    /**
     * Standard Response Builder
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
     * Request Metadata
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
     * Tenant Validation
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
     * CREATE MEMBER
     * POST /api/v1/members
     * =========================================================================
     */
    static async createMember(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const member =
                await MemberService.createMember(
                    req.tenant_id,
                    req.body,
                    req.user
                );

            return this.success(
                res,
                member,
                'Member created successfully',
                201,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * GET MEMBER BY ID
     * GET /api/v1/members/:id
     * =========================================================================
     */
    static async getMember(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const member =
                await MemberService.getMemberById(
                    req.params.id,
                    req.tenant_id
                );

            return this.success(
                res,
                member,
                'Member retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * LIST MEMBERS
     * GET /api/v1/members
     * =========================================================================
     */
    static async getMembers(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const {
                page = 1,
                limit = 20,
                search,
                status,
                branch,
                membershipType
            } = req.query;

            const result =
                await MemberService.getMembers(
                    req.tenant_id,
                    {
                        page: Number(page),
                        limit: Number(limit),
                        search,
                        status,
                        branch,
                        membershipType
                    }
                );

            return this.success(
                res,
                result,
                'Members retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * UPDATE MEMBER
     * PUT /api/v1/members/:id
     * =========================================================================
     */
    static async updateMember(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const member =
                await MemberService.updateMember(
                    req.params.id,
                    req.tenant_id,
                    req.body,
                    req.user
                );

            return this.success(
                res,
                member,
                'Member updated successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * DELETE MEMBER
     * DELETE /api/v1/members/:id
     * =========================================================================
     */
    static async deleteMember(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            await MemberService.deleteMember(
                req.params.id,
                req.tenant_id,
                req.user
            );

            return this.success(
                res,
                null,
                'Member deleted successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * VERIFY MEMBER KYC
     * POST /api/v1/members/:id/verify-kyc
     * =========================================================================
     */
    static async verifyKYC(req, res, next) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const result =
                await MemberService.verifyKYC(
                    req.params.id,
                    req.tenant_id,
                    req.user
                );

            return this.success(
                res,
                result,
                'KYC verification completed',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * MEMBER ACCOUNTS
     * GET /api/v1/members/:id/accounts
     * =========================================================================
     */
    static async getMemberAccounts(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const accounts =
                await MemberService.getMemberAccounts(
                    req.params.id,
                    req.tenant_id
                );

            return this.success(
                res,
                accounts,
                'Member accounts retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * MEMBER LOANS
     * GET /api/v1/members/:id/loans
     * =========================================================================
     */
    static async getMemberLoans(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const loans =
                await MemberService.getMemberLoans(
                    req.params.id,
                    req.tenant_id
                );

            return this.success(
                res,
                loans,
                'Member loans retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * MEMBER SAVINGS
     * GET /api/v1/members/:id/savings
     * =========================================================================
     */
    static async getMemberSavings(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const savings =
                await MemberService.getMemberSavings(
                    req.params.id,
                    req.tenant_id
                );

            return this.success(
                res,
                savings,
                'Member savings retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * MEMBER ANALYTICS
     * GET /api/v1/members/analytics
     * =========================================================================
     */
    static async getAnalytics(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const analytics =
                await MemberService.getAnalytics(
                    req.tenant_id
                );

            return this.success(
                res,
                analytics,
                'Member analytics retrieved successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }

    /**
     * =========================================================================
     * MEMBER GROWTH REPORT
     * GET /api/v1/members/growth
     * =========================================================================
     */
    static async getGrowthReport(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            this.validateTenant(req);

            const report =
                await MemberService.getGrowthReport(
                    req.tenant_id
                );

            return this.success(
                res,
                report,
                'Growth report generated successfully',
                200,
                this.buildMeta(req, startedAt)
            );

        } catch (error) {
            handleError(error, req, res, next);
        }
    }
}

module.exports = MemberController;