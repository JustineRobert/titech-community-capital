'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Loan Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/loanController.js
 *
 * Purpose:
 *   Canonical HTTP/application boundary for loan workflows, portfolio
 *   analytics, risk, fraud and compliance endpoints.
 *
 * Architecture:
 *
 *   HTTP Request
 *        ↓
 *   Authentication / Authorization
 *        ↓
 *   Tenant Context
 *        ↓
 *   Request Validation / Metadata
 *        ↓
 *   LoanWorkflowService
 *        ↓
 *   Financial / Loan Transaction Boundary
 *        ↓
 *   Repository / Domain Services
 *        ↓
 *   Response
 *
 * Controller responsibilities:
 *   - request boundary validation
 *   - authenticated identity extraction
 *   - tenant-context validation
 *   - route parameter normalization
 *   - correlation/request metadata
 *   - service invocation
 *   - standardized response formatting
 *   - centralized error delegation
 *
 * Business logic MUST remain in:
 *   LoanWorkflowService and downstream domain/financial services.
 *
 * Financial mutations MUST NOT be implemented directly in this controller.
 *
 * =============================================================================
 */

const LoanWorkflowService =
    require(
        '../modules/loan/services/loanWorkflowService'
    );

const {
    handleError
} = require(
    '../middlewares/errorMiddleware'
);

// =============================================================================
// Constants
// =============================================================================

const COMPONENT =
    'loan-controller';

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    256;

const CORRELATION_HEADERS =
    Object.freeze([
        'x-correlation-id',
        'x-request-id',
        'x-trace-id'
    ]);

// =============================================================================
// Generic Helpers
// =============================================================================

function normalizeString(
    value,
    field,
    {
        required = false,
        maxLength = MAX_IDENTIFIER_LENGTH
    } = {}
) {
    if (
        value === null ||
        value === undefined
    ) {
        if (
            required
        ) {
            const error =
                new Error(
                    `${field} is required`
                );

            error.code =
                `LOAN_${field.toUpperCase()}_REQUIRED`;

            error.statusCode =
                422;

            throw error;
        }

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    if (
        !normalized
    ) {
        if (
            required
        ) {
            const error =
                new Error(
                    `${field} is required`
                );

            error.code =
                `LOAN_${field.toUpperCase()}_REQUIRED`;

            error.statusCode =
                422;

            throw error;
        }

        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        const error =
            new Error(
                `${field} exceeds the maximum allowed length`
            );

        error.code =
            `LOAN_${field.toUpperCase()}_TOO_LONG`;

        error.statusCode =
            422;

        throw error;
    }

    return normalized;
}

function getHeader(
    req,
    headerName
) {
    if (
        typeof req?.get ===
        'function'
    ) {
        const value =
            req.get(
                headerName
            );

        if (
            typeof value ===
            'string' &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    const value =
        req?.headers?.[
            String(
                headerName
            ).toLowerCase()
        ];

    if (
        typeof value ===
        'string' &&
        value.trim()
    ) {
        return value.trim();
    }

    return null;
}

function getFirstHeader(
    req,
    names
) {
    for (
        const name of names
    ) {
        const value =
            getHeader(
                req,
                name
            );

        if (
            value
        ) {
            return value;
        }
    }

    return null;
}

// =============================================================================
// Tenant Resolution
// =============================================================================

function resolveTenantId(
    req
) {
    const tenantId =
        req?.tenant_id ||
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?._id ||
        req?.auth?.tenantId ||
        req?.user?.tenantId ||
        req?.context?.tenantId;

    return normalizeString(
        tenantId,
        'tenantId',
        {
            required: true
        }
    );
}

// =============================================================================
// Authenticated Principal Resolution
// =============================================================================

function resolvePrincipal(
    req
) {
    return (
        req?.user ||
        req?.auth?.user ||
        null
    );
}

function requireAuthenticatedPrincipal(
    req
) {
    const principal =
        resolvePrincipal(
            req
        );

    if (
        !principal
    ) {
        const error =
            new Error(
                'Authenticated user context is required'
            );

        error.code =
            'LOAN_AUTHENTICATION_REQUIRED';

        error.statusCode =
            401;

        throw error;
    }

    return principal;
}

// =============================================================================
// Route Parameter Validation
// =============================================================================

function requireLoanId(
    req
) {
    return normalizeString(
        req?.params?.loanId,
        'loanId',
        {
            required: true
        }
    );
}

// =============================================================================
// Request Metadata
// =============================================================================

function buildRequestContext(
    req,
    startedAt,
    tenantId
) {
    return {
        component:
            COMPONENT,

        requestId:
            getHeader(
                req,
                'x-request-id'
            ),

        correlationId:
            getFirstHeader(
                req,
                CORRELATION_HEADERS
            ),

        tenantId,

        executionTimeMs:
            Date.now() -
            startedAt
    };
}

function buildFinancialRequestContext(
    req
) {
    return {
        requestId:
            getHeader(
                req,
                'x-request-id'
            ),

        correlationId:
            getFirstHeader(
                req,
                CORRELATION_HEADERS
            ),

        idempotencyKey:
            getHeader(
                req,
                'idempotency-key'
            ),

        traceId:
            getHeader(
                req,
                'x-trace-id'
            )
    };
}

// =============================================================================
// Idempotency
// =============================================================================
//
// Financially mutating loan endpoints should support an idempotency key.
// Do not make reporting/read endpoints depend on it.
// =============================================================================

function requireIdempotencyKey(
    req
) {
    const value =
        getHeader(
            req,
            'idempotency-key'
        );

    return normalizeString(
        value,
        'idempotencyKey',
        {
            required: true,
            maxLength:
                MAX_IDEMPOTENCY_KEY_LENGTH
        }
    );
}

// =============================================================================
// Body Normalization
// =============================================================================

function getBody(
    req
) {
    if (
        req?.body &&
        typeof req.body ===
        'object' &&
        !Array.isArray(
            req.body
        )
    ) {
        return req.body;
    }

    return {};
}

// =============================================================================
// Standard Response
// =============================================================================

class LoanController {

    static success(
        res,
        data,
        message = 'Success',
        statusCode = 200,
        meta = {}
    ) {
        return res
            .status(
                statusCode
            )
            .json({
                success:
                    true,

                message,

                timestamp:
                    new Date().toISOString(),

                meta,

                data
            });
    }

    static buildMeta(
        req,
        startedAt,
        tenantId = null,
        additional = {}
    ) {
        return {
            requestId:
                getHeader(
                    req,
                    'x-request-id'
                ),

            correlationId:
                getFirstHeader(
                    req,
                    CORRELATION_HEADERS
                ),

            tenantId,

            executionTimeMs:
                Date.now() -
                startedAt,

            ...additional
        };
    }

    static validateTenant(
        req
    ) {
        return resolveTenantId(
            req
        );
    }

    static validateAuthenticatedRequest(
        req
    ) {
        const tenantId =
            this.validateTenant(
                req
            );

        const user =
            requireAuthenticatedPrincipal(
                req
            );

        return {
            tenantId,
            user
        };
    }

    static async execute(
        req,
        res,
        next,
        {
            serviceMethod,
            args = [],
            successMessage = 'Success',
            statusCode = 200,
            requireAuth = true,
            requireTenant = true,
            requireIdempotency = false
        } = {}
    ) {
        const startedAt =
            Date.now();

        try {
            let tenantId =
                null;

            let user =
                null;

            if (
                requireTenant ||
                requireAuth
            ) {
                const validated =
                    this.validateAuthenticatedRequest(
                        req
                    );

                tenantId =
                    validated.tenantId;

                user =
                    validated.user;
            }

            if (
                !requireTenant
            ) {
                tenantId =
                    req?.tenant_id ||
                    req?.tenantId ||
                    null;
            }

            let idempotencyKey =
                null;

            if (
                requireIdempotency
            ) {
                idempotencyKey =
                    requireIdempotencyKey(
                        req
                    );
            }

            if (
                typeof LoanWorkflowService?.[
                    serviceMethod
                ] !==
                'function'
            ) {
                const error =
                    new Error(
                        `Loan workflow service method "${serviceMethod}" is unavailable`
                    );

                error.code =
                    'LOAN_SERVICE_METHOD_UNAVAILABLE';

                error.statusCode =
                    503;

                throw error;
            }

            const serviceArgs =
                typeof args ===
                'function'
                    ? args({
                        req,
                        user,
                        tenantId,
                        idempotencyKey,
                        requestContext:
                            buildFinancialRequestContext(
                                req
                            )
                    })
                    : args;

            const result =
                await LoanWorkflowService[
                    serviceMethod
                ](
                    ...serviceArgs
                );

            return this.success(
                res,
                result,
                successMessage,
                statusCode,
                this.buildMeta(
                    req,
                    startedAt,
                    tenantId,
                    {
                        operation:
                            serviceMethod,

                        ...(idempotencyKey
                            ? {
                                idempotencyKey
                            }
                            : {})
                    }
                )
            );
        } catch (
            error
        ) {
            return handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    // =========================================================================
    // CREATE LOAN APPLICATION
    // =========================================================================

    static async createLoanApplication(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'createLoanApplication',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    user,
                    getBody(req),
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan application created',

                statusCode:
                    201
            }
        );
    }

    // =========================================================================
    // REQUEST LOAN
    // =========================================================================

    static async requestLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'requestLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    user,
                    getBody(req),
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan requested successfully',

                statusCode:
                    201,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // LOAN APPROVAL
    // =========================================================================

    static async approveLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'approveLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan approved successfully',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // LOAN REJECTION
    // =========================================================================

    static async rejectLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'rejectLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan rejected successfully',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // DISBURSE LOAN
    // =========================================================================

    static async disburseLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'disburseLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan disbursed successfully',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // RECORD REPAYMENT
    // =========================================================================

    static async recordRepayment(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'recordRepayment',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Repayment recorded successfully',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // LOAN SUMMARY
    // =========================================================================

    static async getLoanSummary(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getLoanSummary',

                args: ({
                    req,
                    user,
                    tenantId
                }) => [
                    requireLoanId(req),
                    user,
                    tenantId
                ],

                successMessage:
                    'Loan summary retrieved',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // PORTFOLIO AT RISK
    // =========================================================================

    static async getPortfolioAtRisk(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getPortfolioMetrics',

                args: ({
                    tenantId
                }) => [
                    tenantId
                ],

                successMessage:
                    'Portfolio metrics retrieved',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // RISK ANALYTICS
    // =========================================================================

    static async getRiskAssessment(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getRiskMetrics',

                args: ({
                    tenantId
                }) => [
                    tenantId
                ],

                successMessage:
                    'Risk metrics retrieved',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // BOARD REPORT
    // =========================================================================

    static async getBoardLoanReport(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getBoardReport',

                args: ({
                    tenantId
                }) => [
                    tenantId
                ],

                successMessage:
                    'Board report generated',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // FRAUD DASHBOARD
    // =========================================================================

    static async getFraudAlerts(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getFraudAlerts',

                args: ({
                    tenantId
                }) => [
                    tenantId
                ],

                successMessage:
                    'Fraud alerts retrieved',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // COMPLIANCE DASHBOARD
    // =========================================================================

    static async getComplianceAlerts(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'getComplianceAlerts',

                args: ({
                    tenantId
                }) => [
                    tenantId
                ],

                successMessage:
                    'Compliance alerts retrieved',

                statusCode:
                    200
            }
        );
    }

    // =========================================================================
    // WRITE OFF
    // =========================================================================

    static async writeOffLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'writeOffLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan written off',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }

    // =========================================================================
    // RESTRUCTURE
    // =========================================================================

    static async restructureLoan(
        req,
        res,
        next
    ) {
        return this.execute(
            req,
            res,
            next,
            {
                serviceMethod:
                    'restructureLoan',

                args: ({
                    req,
                    user,
                    tenantId,
                    requestContext
                }) => [
                    requireLoanId(req),
                    getBody(req),
                    user,
                    tenantId,
                    requestContext
                ],

                successMessage:
                    'Loan restructured',

                statusCode:
                    200,

                requireIdempotency:
                    true
            }
        );
    }
}

// =============================================================================
// Exports
// =============================================================================

module.exports =
    LoanController;